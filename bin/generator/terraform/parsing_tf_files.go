package terraform

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"os"
	"os/exec"
	"regexp"
	"strings"

	"github.com/ghodss/yaml"
	"github.com/hashicorp/hcl"
)

type Element struct {
	GK       string
	SK       int
	EK       string
	Elements []interface{}
}

// ParsingTfFile - parsing all tf file from directory
func ParsingTfFile(source string, destination string) {
	f, err := os.Open(source)
	if err != nil {
		fmt.Println(err)
	}
	fileInfo, err := f.Readdir(-1)
	f.Close()
	if err != nil {
		fmt.Println(err)
	}
	newYml := ""
	for _, file := range fileInfo {
		if strings.Index(file.Name(), ".tf") > -1 &&
			!file.IsDir() &&
			strings.Index(file.Name(), ".tfvars") == -1 &&
			strings.Index(file.Name(), "locals.tf") == -1 {
			newYml += StartProccesingTfFile(source + file.Name())
			if source == destination {
				cmd := exec.Command("rm", "-rf", source+file.Name())
				if err := cmd.Run(); err != nil {
					fmt.Println(err)
				}
				cmd = exec.Command("rm", source+"locals.tf")
				if err := cmd.Run(); err != nil {
					fmt.Println(err)
				}
			}
		}
	}
	newYml = strings.Replace(newYml, "\n", "\n    ", -1)
	newYml = strings.Replace(newYml, "- ", "  ", -1)
	newYml = PrepareNewYmlFromOld(source, "  template:\n    "+newYml)
	re := regexp.MustCompile(`(?m)\n(.+?|){}`)
	for _, match := range re.FindAllString(newYml, -1) {
		newYml = strings.Replace(newYml, match, " {}", 1)
	}
	re = regexp.MustCompile(`(?m):\n          [^ ]`)
	for _, match := range re.FindAllString(newYml, -1) {
		newYml = strings.Replace(newYml, match, ":\n        - "+match[len(match)-1:], 1)
	}
	ioutil.WriteFile(destination+".terrahub.yml", []byte(newYml), 0777)
}

// StartProccesingTfFile - Start proccesing
func StartProccesingTfFile(filePath string) string {
	input, _ := ioutil.ReadFile(filePath)

	var v interface{}
	err := hcl.Unmarshal(input, &v)
	if err != nil {
		panic(err)
	}

	jsonLoad, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		panic(err)
	}

	y, err := yaml.JSONToYAML(NormalizeJson(jsonLoad))
	if err != nil {
		panic(err)
	}

	return string(y)
}

func NormalizeJson(jsonLoad []byte) []byte {
	var m map[string]interface{}
	err := json.Unmarshal(jsonLoad, &m)
	if err != nil {
		panic(err)
	}
	uniqKeys := CheckElementByType([]Element{}, m)

	for _, value := range uniqKeys {
		m[value.GK].([]interface{})[value.SK].(map[string]interface{})[value.EK] = value.Elements
	}

	jsonLoad, err = json.Marshal(m)

	if err != nil {
		fmt.Println("error:", err)
	}
	newJson := strings.Replace(string(jsonLoad), ",null", "", -1)
	return []byte(newJson)
}

func CheckElementByType(uniqKeys []Element, m map[string]interface{}) []Element {
	for k, v := range m {
		switch v.(type) {
		case []interface{}:
			element := m[k].([]interface{})
			for key, value1 := range element {
				switch value1.(type) {
				case map[string]interface{}:
					element2 := element[key].(map[string]interface{})
					for key2, value2 := range element2 {
						switch value2.(type) {
						case []interface{}:
							if !Contains(uniqKeys, key2) {
								elements := make([]interface{}, 0)
								elements = append(elements, value2)
								uniqKeys = append(uniqKeys, Element{k, key, key2, elements})
							} else {
								lE := uniqKeys[ReturnElement(uniqKeys, key2)]
								lE.Elements = append(lE.Elements, value2)
								m[k].([]interface{})[key] = nil
							}
						}
					}
				}
			}
		}
	}
	return uniqKeys
}

func Contains(arr []Element, str string) bool {
	for _, a := range arr {
		if a.EK == str {
			return true
		}
	}
	return false
}

func ReturnElement(arr []Element, str string) int {
	for key, a := range arr {
		if a.EK == str {
			return key
		}
	}
	return 0
}

// PrepareNewYmlFromOld - Prepare new yml from old
func PrepareNewYmlFromOld(source string, context string) string {
	newYml := ""
	context = AddTfVars(source, context)
	oldYml, err := ioutil.ReadFile(source + ".terrahub.yml")
	if err != nil {
		paths := strings.Split(source, "/")
		newYml += "## local config\n" +
			"component:\n" +
			"  name: '" + paths[len(paths)-2] + "'\n" + context
	} else {
		re := regexp.MustCompile(`(?m)\n\n`)
		for _, match := range re.FindAllString(string(oldYml), -1) {
			newYml = strings.Replace(string(oldYml), match, "\n"+context+"\n", 1)
		}
	}
	return newYml
}

// AddTfVars - Add tfvars values
func AddTfVars(source string, context string) string {
	newYml := ""
	_, err := ioutil.ReadFile(source + "default.tfvars")
	if err != nil {
		return context
	}

	newYml = StartProccesingTfFile(source + "default.tfvars")
	re := regexp.MustCompile(`(?m).+?\n`)
	for _, match := range re.FindAllString(newYml, -1) {
		newYml = strings.Replace(newYml, match, "      "+match, 1)
	}
	newYml = strings.Replace(newYml, "- ", "  ", -1)
	cmd := exec.Command("rm", source+"default.tfvars")
	if err := cmd.Run(); err != nil {
		fmt.Println(err)
	}
	return context + "tfvars:\n" + newYml
}
