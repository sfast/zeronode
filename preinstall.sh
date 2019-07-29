#!/usr/bin/env bash

lowercase(){
    echo "$1" | sed "y/ABCDEFGHIJKLMNOPQRSTUVWXYZ/abcdefghijklmnopqrstuvwxyz/"
}

OS=`lowercase \`uname\``
KERNEL=`uname -r`
MACH=`uname -m`

packageManager="sudo apt-get"
libzmq="libzmq3-dev"

if [ "${OS}" == "windowsnt" ]; then
    OS=windows
elif [ "${OS}" == "darwin" ]; then
    OS=mac
    packageManager="brew"
    libzmq="zeromq"
else
    OS=`uname`
    if [ "${OS}" = "SunOS" ] ; then
        OS=Solaris
        ARCH=`uname -p`
        OSSTR="${OS} {$REV}(${ARCH} `uname -v`)"
    elif [ "${OS}" = "AIX" ] ; then
        packageManager="smit"
        OSSTR="${OS} `oslevel` (`oslevel -r`)"
    elif [ "${OS}" = "Linux" ] ; then
        if [ -f /etc/redhat-release ] ; then
            DistroBasedOn='RedHat'
            packageManager="sudo yum"
            libzmq="zeromq"
            DIST=`cat /etc/redhat-release |sed s/\ release.*//`
            PSUEDONAME=`cat /etc/redhat-release | sed s/.*\(// | sed s/\)//`
            REV=`cat /etc/redhat-release | sed s/.*release\ // | sed s/\ .*//`
        elif [ -f /etc/SuSE-release ] ; then
            DistroBasedOn='SuSe'
            packageManager="zypper"
            libzmq="zeromq"
            PSUEDONAME=`cat /etc/SuSE-release | tr "\n" ' '| sed s/VERSION.*//`
            REV=`cat /etc/SuSE-release | tr "\n" ' ' | sed s/.*=\ //`
        elif [ -f /etc/mandrake-release ] ; then
            DistroBasedOn='Mandrake'
            PSUEDONAME=`cat /etc/mandrake-release | sed s/.*\(// | sed s/\)//`
            REV=`cat /etc/mandrake-release | sed s/.*release\ // | sed s/\ .*//`
        elif [ -f /etc/debian_version ] && [ -f /etc/lsb-release ] ; then
            DistroBasedOn='Debian'
            DIST=`cat /etc/lsb-release | grep '^DISTRIB_ID' | awk -F=  '{ print $2 }'`
            PSUEDONAME=`cat /etc/lsb-release | grep '^DISTRIB_CODENAME' | awk -F=  '{ print $2 }'`
            REV=`cat /etc/lsb-release | grep '^DISTRIB_RELEASE' | awk -F=  '{ print $2 }'`
        elif [ -f /sys/hypervisor/uuid ] && [ `head -c 3 /sys/hypervisor/uuid` == ec2 ]; then
            DistroBasedOn='RedHat'
            packageManager="sudo yum"
            libzmq="zeromq"
        fi
        if [ -f /etc/UnitedLinux-release ] ; then
            DIST="${DIST}[`cat /etc/UnitedLinux-release | tr "\n" ' ' | sed s/VERSION.*//`]"
        fi
        OS=`lowercase $OS`
        DistroBasedOn=`lowercase $DistroBasedOn`
        readonly DIST
        readonly DistroBasedOn
        readonly PSUEDONAME
        readonly REV
        readonly KERNEL
        readonly MACH
    fi

fi

if [ "${OS}" != "mac" ] && [ "${DistroBasedOn}" != "debian" ] && [ "${DistroBasedOn}" != "redhat" ]; then
    echo "Can't install zeromq on this os, need to install manually."
    exit 0
fi

if [ -z "$(which pkg-config)" ]; then
    $packageManager install pkg-config
fi

pkg-config libzmq --exists

haveZmq=$?

if [ $haveZmq == 0 ]; then
    exit 0;
fi

$packageManager install -y $libzmq
